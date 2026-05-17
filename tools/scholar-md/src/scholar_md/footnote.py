from __future__ import annotations

import re
from collections import Counter, defaultdict

from .models import Footnote, PageLayout, TextLine
from .notes import note_anchor, note_label
from .utils import clean_text, merge_hyphenated_text

FOOTNOTE_START_RE = re.compile(
    r"^\s*(?:(?P<number>\d{1,3})(?:[.)]\s*|\s+(?=[A-Z“\"'(])|(?=[A-Z“\"'(]))|"
    r"(?P<symbol>[*†‡§])(?:[.)]\s*|\s+)?)(?P<body>.*)"
)


def extract_and_link_footnotes(pages: list[PageLayout]) -> list[Footnote]:
    footnotes: list[Footnote] = []
    unlinked_counts: defaultdict[int, int] = defaultdict(int)
    for page in pages:
        footnote_lines = [line for line in page.lines if line.region == "footnote"]
        columns = sorted({line.column for line in footnote_lines})
        for column in columns:
            entries = group_footnote_lines([line for line in footnote_lines if line.column == column])
            for entry in entries:
                first = clean_text(entry[0].text)
                match = FOOTNOTE_START_RE.match(first)
                if not match:
                    unlinked_counts[page.page_num] += 1
                    content = merge_hyphenated_text("\n".join(clean_text(line.text) for line in entry)).strip()
                    if not content:
                        continue
                    footnotes.append(
                        Footnote(
                            marker=f"p{page.page_num}-note-{unlinked_counts[page.page_num]}",
                            content=content,
                            page_num=page.page_num,
                            anchor=f"fn-p{page.page_num:03d}-note-{unlinked_counts[page.page_num]:03d}",
                            label=note_label("", page.page_num, linked=False),
                            linked=False,
                            kind="unlinked_note",
                            confidence=0.72,
                            warnings=["No inline marker was detected for this note-like page-bottom text."],
                        )
                    )
                    continue
                marker = match.group("number") or match.group("symbol") or ""
                body = match.group("body")
                rest = [clean_text(line.text) for line in entry[1:]]
                content = merge_hyphenated_text("\n".join([body] + rest)).strip()
                footnote = Footnote(marker=marker, content=content, page_num=page.page_num)
                link_footnote_reference(page, footnote)
                footnotes.append(footnote)
    assign_note_anchors(footnotes)
    return footnotes


def group_footnote_lines(lines: list[TextLine]) -> list[list[TextLine]]:
    entries: list[list[TextLine]] = []
    for line in sorted(lines, key=lambda item: (item.bbox.y0, item.bbox.x0)):
        text = clean_text(line.text)
        if FOOTNOTE_START_RE.match(text) and (not entries or text[:1].isdigit() or text[:1] in "*†‡§"):
            entries.append([line])
        elif entries:
            entries[-1].append(line)
        else:
            entries.append([line])
    return entries


def link_footnote_reference(page: PageLayout, footnote: Footnote) -> None:
    marker = footnote.marker
    for line in page.lines:
        if line.region != "body":
            continue
        for span in line.spans:
            if span.role == f"note_ref:{marker}":
                footnote.source_line_id = line.line_id
                footnote.source_bbox = span.bbox
                footnote.linked = True
                footnote.confidence = 0.94
                return

    for line in page.lines:
        if line.region != "body":
            continue
        for span in line.spans:
            if clean_text(span.text) != marker:
                continue
            if span.size and line.font_size and span.size > line.font_size * 0.92:
                continue
            if span.bbox.y1 > line.bbox.y0 + line.bbox.height * 0.72:
                continue
            span.role = f"note_ref:{marker}"
            footnote.source_line_id = line.line_id
            footnote.source_bbox = span.bbox
            footnote.linked = True
            footnote.confidence = 0.9
            return
    footnote.warnings.append("No superscript reference was linked on the source page.")


def assign_note_anchors(footnotes: list[Footnote]) -> None:
    numeric_counts = Counter(note.marker for note in footnotes if note.marker.isdigit())
    for note in footnotes:
        if not note.anchor:
            duplicate = numeric_counts[note.marker] > 1 if note.marker.isdigit() else False
            note.anchor = note_anchor(note.marker, note.page_num, duplicate=duplicate)
        if not note.label:
            note.label = note_label(note.marker, note.page_num, linked=note.linked)
        if not note.linked and note.kind == "footnote":
            note.kind = "unlinked_note"
