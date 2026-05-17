from __future__ import annotations

import re
from collections import Counter
from statistics import median

from .formula import annotate_math_spans, is_likely_math_text, line_is_display_formula, math_density
from .models import ExtractedDocument, PageLayout, TextLine
from .utils import clean_text, mode

FOOTNOTE_MARKER_RE = re.compile(
    r"^\s*(?:\d{1,3}(?:[.)]\s*|\s+(?=[A-Z“\"'(])|(?=[A-Z“\"'(]))|[*†‡§](?:\s+|[.)])?)"
)
CAPTION_RE = re.compile(r"^\s*(?:(fig(?:ure)?|table)\s+\d+\s*[:.])", re.IGNORECASE)
AUTHOR_NOTE_RE = re.compile(
    r"^\s*(?:date|received|accepted|published|penultimate draft|final version|"
    r"correspondence address|copyright|©|i would like to thank|acknowledgements?)\b",
    re.IGNORECASE,
)


def prepare_layout(document: ExtractedDocument, keep_headers: bool = False) -> ExtractedDocument:
    for page in document.pages:
        page.lines = merge_same_baseline_lines(page.lines)
    profile_pages(document.pages)
    repeated_headers, repeated_footers = detect_repeated_marginalia(document.pages)
    for page in document.pages:
        page.footnote_separator_y = detect_footnote_separator(page)
        assign_columns(page)
        classify_page_lines(page, repeated_headers, repeated_footers, keep_headers=keep_headers)
        page.lines = sort_lines_for_reading(page.lines, page.columns)
    return document


def profile_pages(pages: list[PageLayout]) -> None:
    for page in pages:
        candidate_sizes = [
            span.size
            for line in page.lines
            for span in line.spans
            if page.height * 0.08 < span.bbox.y0 < page.height * 0.88
        ]
        page.body_size = estimate_body_size(candidate_sizes)


def estimate_body_size(candidate_sizes: list[float]) -> float:
    if not candidate_sizes:
        return 0.0
    rounded = [round(value / 0.25) * 0.25 for value in candidate_sizes if value > 0]
    counts = Counter(rounded)
    dominant_size, dominant_count = counts.most_common(1)[0]
    larger_body_candidates = [
        size
        for size, count in counts.items()
        if size > dominant_size + 0.75 and count >= max(3, dominant_count * 0.25)
    ]
    if larger_body_candidates:
        return max(larger_body_candidates)
    return mode(candidate_sizes, precision=0.25, default=median(candidate_sizes))


def detect_repeated_marginalia(pages: list[PageLayout]) -> tuple[set[str], set[str]]:
    header_counter: Counter[str] = Counter()
    footer_counter: Counter[str] = Counter()
    for page in pages:
        for line in page.lines:
            normalized = marginalia_key(line.text)
            if not normalized:
                continue
            if line.bbox.y0 < page.height * 0.12:
                header_counter[normalized] += 1
            if line.bbox.y1 > page.height * 0.9:
                footer_counter[normalized] += 1
    threshold = max(2, int(len(pages) * 0.35))
    headers = {text for text, count in header_counter.items() if count >= threshold}
    footers = {text for text, count in footer_counter.items() if count >= threshold}
    return headers, footers


def marginalia_key(text: str) -> str:
    normalized = clean_text(text).lower()
    normalized = re.sub(r"\d+", "#", normalized)
    if len(normalized) <= 1:
        return ""
    return normalized


def detect_footnote_separator(page: PageLayout) -> float | None:
    candidates = [
        rule
        for rule in page.horizontal_rules
        if rule.y0 > page.height * 0.55 and rule.width < page.width * 0.55
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda box: box.y0).y0


def assign_columns(page: PageLayout) -> None:
    eligible = [
        line
        for line in page.lines
        if page.height * 0.12 < line.bbox.y0 < page.height * 0.82
        and line.bbox.width < page.width * 0.58
    ]
    left = [line for line in eligible if line.bbox.cx < page.width * 0.47]
    right = [line for line in eligible if line.bbox.cx > page.width * 0.53]
    two_columns = len(left) >= 2 and len(right) >= 2
    if two_columns:
        left_right_edge = median([line.bbox.x1 for line in left])
        right_left_edge = median([line.bbox.x0 for line in right])
        two_columns = right_left_edge - left_right_edge > page.width * 0.05
    page.columns = 2 if two_columns else 1
    for line in page.lines:
        if page.columns == 1:
            line.column = 0
        elif line.bbox.width > page.width * 0.62:
            line.column = -1
        elif line.bbox.cx < page.width * 0.5:
            line.column = 0
        else:
            line.column = 1


def classify_page_lines(
    page: PageLayout,
    repeated_headers: set[str],
    repeated_footers: set[str],
    keep_headers: bool = False,
) -> None:
    in_footnote_zone: dict[int, bool] = {}
    footnote_start_y = infer_footnote_start_y(page)
    for line in sorted(page.lines, key=lambda item: (line_y_sort_key(item), item.bbox.x0)):
        column = line.column if line.column in {0, 1} else -1
        key = marginalia_key(line.text)
        text = clean_text(line.text)
        if not keep_headers and is_page_number_line(line, page):
            line.set_region("footer", confidence=0.9)
            continue
        if not keep_headers and line.bbox.y0 < page.height * 0.12 and key in repeated_headers:
            line.set_region("header", confidence=0.95)
            continue
        if not keep_headers and is_footer_line(line, page, key, repeated_footers):
            line.set_region("footer", confidence=0.92)
            continue

        annotate_math_spans(line)
        if is_footnote_line(line, page, in_footnote_zone.get(column, False), footnote_start_y.get(column)):
            line.set_region("footnote", confidence=0.82)
            in_footnote_zone[column] = True
            continue
        if CAPTION_RE.match(text):
            line.set_region("figure", confidence=0.78)
            continue
        if line_is_display_formula(line):
            line.set_region("formula", confidence=0.84)
            continue
        line.set_region("body", confidence=1.0)
        if any(span.role == "math" for span in line.spans) and math_density(line.text) < 0.08:
            line.warnings.append("inline math span detected in prose context")


def is_footer_line(line: TextLine, page: PageLayout, key: str, repeated_footers: set[str]) -> bool:
    text = clean_text(line.text)
    if line.bbox.y1 < page.height * 0.9:
        return False
    if key in repeated_footers:
        return True
    return bool(re.fullmatch(r"[-–—]?\s*\d+\s*[-–—]?", text))


def is_page_number_line(line: TextLine, page: PageLayout) -> bool:
    text = clean_text(line.text)
    in_margin = line.bbox.y0 < page.height * 0.12 or line.bbox.y1 > page.height * 0.88
    return in_margin and bool(re.fullmatch(r"[-–—]?\s*\d{1,4}\s*[-–—]?", text))


def is_footnote_line(line: TextLine, page: PageLayout, in_footnote_zone: bool, inferred_start_y: float | None = None) -> bool:
    text = clean_text(line.text)
    below_separator = page.footnote_separator_y is not None and line.bbox.y0 > page.footnote_separator_y
    small_text = page.body_size > 0 and line.font_size < page.body_size * 0.92
    inferred_zone = inferred_start_y is not None and line.bbox.y0 >= inferred_start_y - 1.0
    if inferred_zone and small_text:
        return True
    if below_separator and not small_text:
        return False
    bottom_small = line.bbox.y0 > page.height * 0.72 and small_text
    starts_like_footnote = bool(FOOTNOTE_MARKER_RE.match(text))
    author_note = page.page_num == 1 and bottom_small and bool(AUTHOR_NOTE_RE.match(text))
    return (below_separator or bottom_small) and (starts_like_footnote or in_footnote_zone or author_note)


def infer_footnote_start_y(page: PageLayout) -> dict[int, float]:
    starts: dict[int, float] = {}
    if page.body_size <= 0:
        return starts
    for line in sorted(page.lines, key=lambda item: (line_y_sort_key(item), item.bbox.x0)):
        column = line.column if line.column in {0, 1} else -1
        if column in starts:
            continue
        text = clean_text(line.text)
        small_text = line.font_size < page.body_size * 0.92
        if not small_text or line.bbox.y0 < page.height * 0.52:
            continue
        starts_like_footnote = bool(FOOTNOTE_MARKER_RE.match(text))
        first_page_note = page.page_num == 1 and bool(AUTHOR_NOTE_RE.match(text))
        near_text_margin = line.bbox.x0 < page.width * 0.28
        if near_text_margin and (starts_like_footnote or first_page_note):
            starts[column] = line.bbox.y0
    return starts


def merge_same_baseline_lines(lines: list[TextLine]) -> list[TextLine]:
    if len(lines) < 2:
        return lines
    merged: list[TextLine] = []
    current: list[TextLine] = []
    for line in sorted(lines, key=lambda item: (line_y_sort_key(item), item.bbox.x0)):
        if not current:
            current = [line]
            continue
        previous = current[-1]
        if should_merge_line_fragment(previous, line):
            current.append(line)
            continue
        merged.append(merge_line_group(current))
        current = [line]
    if current:
        merged.append(merge_line_group(current))
    return sorted(merged, key=lambda item: (line_y_sort_key(item), item.bbox.x0))


def should_merge_line_fragment(previous: TextLine, current: TextLine) -> bool:
    if abs(previous.font_size - current.font_size) > max(0.35, previous.font_size * 0.04):
        return False
    y_tolerance = max(1.6, max(previous.font_size, current.font_size, 1.0) * 0.22)
    if abs(previous.bbox.cy - current.bbox.cy) > y_tolerance:
        return False
    overlap = min(previous.bbox.y1, current.bbox.y1) - max(previous.bbox.y0, current.bbox.y0)
    if overlap < min(previous.bbox.height, current.bbox.height) * 0.55:
        return False
    gap = current.bbox.x0 - previous.bbox.x1
    max_gap = max(22.0, max(previous.font_size, current.font_size, 1.0) * 3.2)
    return -1.0 <= gap <= max_gap


def merge_line_group(lines: list[TextLine]) -> TextLine:
    if len(lines) == 1:
        return lines[0]
    line_id = min(line.line_id for line in lines)
    spans = [span for line in lines for span in line.spans]
    merged = TextLine.from_spans(spans, page_num=lines[0].page_num, line_id=line_id)
    merged.column = lines[0].column
    merged.confidence = min(line.confidence for line in lines)
    merged.warnings = [warning for line in lines for warning in line.warnings]
    return merged


def sort_lines_for_reading(lines: list[TextLine], columns: int) -> list[TextLine]:
    if columns != 2:
        return sorted(lines, key=lambda line: region_sort_key(line) + (line_y_sort_key(line), line.bbox.x0))

    non_marginal = [line for line in lines if line.region not in {"header", "footer", "footnote"} and line.column in {0, 1}]
    first_column_y = min((line.bbox.y0 for line in non_marginal), default=0)
    top_full: list[TextLine] = []
    left: list[TextLine] = []
    right: list[TextLine] = []
    late_full: list[TextLine] = []
    marginal: list[TextLine] = []

    for line in lines:
        if line.region in {"header", "footer", "footnote"}:
            marginal.append(line)
        elif line.column == -1 and line.bbox.y0 <= first_column_y + max(24, line.font_size * 3):
            top_full.append(line)
        elif line.column == 0:
            left.append(line)
        elif line.column == 1:
            right.append(line)
        else:
            late_full.append(line)

    return (
        sorted(top_full, key=lambda line: (line_y_sort_key(line), line.bbox.x0))
        + sorted(left, key=lambda line: (line_y_sort_key(line), line.bbox.x0))
        + sorted(right, key=lambda line: (line_y_sort_key(line), line.bbox.x0))
        + sorted(late_full, key=lambda line: (line_y_sort_key(line), line.bbox.x0))
        + sorted(marginal, key=lambda line: region_sort_key(line) + (line_y_sort_key(line), line.bbox.x0))
    )


def region_sort_key(line: TextLine) -> tuple[int]:
    order = {"header": 0, "body": 1, "formula": 1, "figure": 1, "footnote": 2, "footer": 3}
    return (order.get(line.region, 1),)


def line_y_sort_key(line: TextLine) -> float:
    return round(line.bbox.y0 / 2.0) * 2.0
