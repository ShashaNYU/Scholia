from __future__ import annotations

import re

from .models import TextLine
from .utils import clean_text, merge_hyphenated_text

ROMAN_SECTION_RE = re.compile(r"^[IVXLCDM]+[.)]\s+\S", re.IGNORECASE)


def build_paragraphs(lines: list[TextLine]) -> list[list[TextLine]]:
    paragraphs: list[list[TextLine]] = []
    current: list[TextLine] = []
    for line in lines:
        if not current:
            current = [line]
            continue
        prev = current[-1]
        if starts_new_paragraph(prev, line):
            paragraphs.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        paragraphs.append(current)
    return paragraphs


def starts_new_paragraph(prev: TextLine, curr: TextLine) -> bool:
    if prev.page_num != curr.page_num:
        return not is_page_break_continuation(prev, curr)
    if prev.column != curr.column:
        if is_column_page_continuation(prev, curr):
            return False
        return True
    line_height = max(prev.font_size, curr.font_size, prev.bbox.height, curr.bbox.height, 1.0)
    y_gap = curr.bbox.y0 - prev.bbox.y1
    if looks_like_numbered_heading(prev.text) and y_gap > line_height * 0.25:
        return True
    if looks_like_numbered_heading(curr.text) and y_gap > line_height * 0.35:
        return True
    if y_gap > line_height * 1.35:
        return True
    if is_parenthetical_label_continuation(prev, curr, line_height):
        return False
    if is_indented_paragraph_start(prev, curr, line_height):
        return True
    prev_short = prev.bbox.width < max(curr.bbox.width, prev.bbox.width) * 0.68
    curr_indented = curr.bbox.x0 > prev.bbox.x0 + max(12, curr.font_size)
    return prev_short and curr_indented


def is_parenthetical_label_continuation(prev: TextLine, curr: TextLine, line_height: float) -> bool:
    prev_text = clean_text(prev.text)
    curr_text = clean_text(curr.text)
    if not prev_text or not curr_text:
        return False
    if not re.match(r"^(?:\(\d{1,3}\)\s+)?\([a-z]\)\s+\S", prev_text):
        return False
    y_gap = curr.bbox.y0 - prev.bbox.y1
    if y_gap < -line_height * 0.2 or y_gap > line_height * 0.75:
        return False
    return curr.bbox.x0 > prev.bbox.x0 + max(12.0, curr.font_size)


def is_indented_paragraph_start(prev: TextLine, curr: TextLine, line_height: float) -> bool:
    prev_text = clean_text(prev.text)
    curr_text = clean_text(curr.text)
    if not prev_text or not curr_text:
        return False
    if not ends_like_sentence_or_note(prev_text):
        return False
    if not re.match(r"^[A-ZÀ-ÖØ-Þ“\"'‘(]", curr_text):
        return False
    y_gap = curr.bbox.y0 - prev.bbox.y1
    if y_gap < -line_height * 0.2 or y_gap > line_height * 1.35:
        return False
    indent = curr.bbox.x0 - prev.bbox.x0
    return indent >= max(6.0, curr.font_size * 0.65)


def ends_like_sentence_or_note(text: str) -> bool:
    stripped = clean_text(text).rstrip()
    stripped = re.sub(r"(?:\d{1,3}|[*†‡§])$", "", stripped).rstrip()
    return bool(re.search(r"[:.;!?][”\"')\]]?$", stripped))


def is_page_break_continuation(prev: TextLine, curr: TextLine) -> bool:
    if prev.region != "body" or curr.region != "body":
        return False
    if looks_like_numbered_heading(prev.text) or looks_like_numbered_heading(curr.text):
        return False
    prev_text = clean_text(prev.text)
    curr_text = clean_text(curr.text)
    if not prev_text or not curr_text:
        return False
    if re.search(r"[:.;!?][”\"')\]]?$", prev_text):
        return False
    if re.match(r"^(?:[•·∙]|[-*]\s+|\d{1,3}[.)]\s+)", curr_text):
        return False
    same_indent = abs(prev.bbox.x0 - curr.bbox.x0) <= max(18.0, curr.font_size * 2.2)
    starts_like_continuation = bool(re.match(r"^[a-zà-öø-ÿ(“\"'∼∀∃]", curr_text))
    return same_indent or starts_like_continuation


def is_column_page_continuation(prev: TextLine, curr: TextLine) -> bool:
    if prev.region != "body" or curr.region != "body":
        return False
    if prev.column != 0 or curr.column != 1:
        return False
    if looks_like_numbered_heading(prev.text) or looks_like_numbered_heading(curr.text):
        return False
    prev_text = clean_text(prev.text)
    curr_text = clean_text(curr.text)
    if not prev_text or not curr_text:
        return False
    if re.search(r"[:.;!?][”\"')\]]?$", prev_text):
        return False
    if re.match(r"^(?:[•·∙]|[-*]\s+|\(\d{1,3}[′']\)\s+|\d{1,3}[.)]\s+)", curr_text):
        return False
    upward_jump = prev.bbox.y0 - curr.bbox.y0
    min_jump = max(120.0, max(prev.font_size, curr.font_size, 1.0) * 12.0)
    starts_like_continuation = bool(re.match(r"^[a-zà-öø-ÿ(“\"'∼∀∃]", curr_text))
    return upward_jump > min_jump and starts_like_continuation


def count_page_break_merges(paragraphs: list[list[TextLine]]) -> int:
    count = 0
    for paragraph in paragraphs:
        for prev, curr in zip(paragraph, paragraph[1:]):
            if prev.page_num != curr.page_num:
                count += 1
    return count


def join_paragraph_lines(texts: list[str]) -> str:
    raw = "\n".join(clean_text(text) for text in texts if clean_text(text))
    raw = merge_hyphenated_text(raw)
    return " ".join(part.strip() for part in raw.splitlines() if part.strip())


def looks_like_numbered_heading(text: str) -> bool:
    cleaned = clean_text(text)
    return len(cleaned) <= 160 and bool(re.match(r"^\d+(?:\.\d+)*\.\s+\S", cleaned) or ROMAN_SECTION_RE.match(cleaned))
