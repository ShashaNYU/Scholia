from __future__ import annotations

import re

from .formula import math_density, unicode_math_to_latex
from .models import DocumentNode, DocumentPlan, ExtractedDocument, Footnote, InlineMarker, TextLine
from .notes import detect_note_profile
from .paragraph import build_paragraphs, count_page_break_merges
from .references import collect_reference_entries, is_references_heading
from .utils import clean_text

COMMON_SECTION_HEADINGS = {
    "abstract",
    "acknowledgements",
    "acknowledgments",
    "appendix",
    "bibliography",
    "conclusion",
    "concluding remarks",
    "introduction",
    "notes",
    "references",
}

ROMAN_SECTION_RE = re.compile(r"^(?P<marker>[IVXLCDM]+)[.)]\s+\S", re.IGNORECASE)


def build_document_plan(
    document: ExtractedDocument,
    footnotes: list[Footnote],
    inline_markers: list[InlineMarker],
) -> DocumentPlan:
    nodes: list[DocumentNode] = []
    reference_lines: list[TextLine] = []
    references_started = False
    quarantined = 0
    page_break_merges = 0
    definition_gloss_blocks = 0
    fraction_candidates = 0
    ordered_list_recovered = 0
    blockquote_blocks = 0
    figure_line_keys = detect_figure_area_lines(document)
    text_edges = infer_page_text_edges(document)

    paragraph_buffer: list[TextLine] = []

    def append_text_block(paragraph: list[TextLine], page_body_size: float, page_height: float) -> None:
        nonlocal blockquote_blocks
        if not paragraph:
            return
        first = paragraph[0]
        if is_display_quote_block(paragraph, text_edges):
            nodes.append(DocumentNode(kind="blockquote", text=clean_text("\n".join(line.text for line in paragraph)), page_num=first.page_num, lines=paragraph))
            blockquote_blocks += 1
            return
        if is_display_heading_block(paragraph, page_body_size, page_height):
            nodes.append(
                DocumentNode(
                    kind="heading",
                    text=clean_text("\n".join(line.text for line in paragraph)),
                    page_num=first.page_num,
                    lines=paragraph,
                    level=heading_level(first, page_body_size),
                )
            )
            return
        if is_structural_heading(first, page_body_size, page_height):
            nodes.append(
                DocumentNode(
                    kind="heading",
                    text=clean_text(first.text),
                    page_num=first.page_num,
                    lines=[first],
                    level=structural_heading_level(first, page_body_size, page_height),
                )
            )
            rest = paragraph[1:]
            if rest:
                nodes.append(DocumentNode(kind="paragraph", text=clean_text("\n".join(line.text for line in rest)), page_num=rest[0].page_num, lines=rest))
            return
        text = "\n".join(line.text for line in paragraph)
        if len(paragraph) == 1 and is_heading(first, page_body_size, page_height):
            nodes.append(DocumentNode(kind="heading", text=clean_text(text), page_num=first.page_num, lines=paragraph, level=heading_level(first, page_body_size)))
        else:
            nodes.append(DocumentNode(kind="paragraph", text=clean_text(text), page_num=first.page_num, lines=paragraph))

    def append_segmented_paragraph(paragraph: list[TextLine], page_body_size: float, page_height: float) -> None:
        nonlocal ordered_list_recovered
        plain: list[TextLine] = []
        index = 0
        while index < len(paragraph):
            line = paragraph[index]
            marker = detect_list_marker(line)
            if marker is None:
                plain.append(line)
                index += 1
                continue
            append_text_block(plain, page_body_size, page_height)
            plain = []
            item_lines = [line]
            index += 1
            while index < len(paragraph) and detect_list_marker(paragraph[index]) is None and is_list_continuation(line, item_lines[-1], paragraph[index]):
                item_lines.append(paragraph[index])
                index += 1
            if marker["recovered"]:
                ordered_list_recovered += 1
            nodes.append(
                DocumentNode(
                    kind="list_item",
                    text=clean_text("\n".join(item.text for item in item_lines)),
                    page_num=line.page_num,
                    lines=item_lines,
                    list_kind=marker["kind"],
                    list_level=marker["level"],
                    list_index=marker["index"],
                    list_marker=str(marker.get("marker", "")),
                )
            )
        append_text_block(plain, page_body_size, page_height)

    def flush_paragraphs(page_body_size: float = 0.0, page_height: float = 0.0) -> None:
        nonlocal paragraph_buffer, page_break_merges
        if not paragraph_buffer:
            return
        paragraphs = build_paragraphs(paragraph_buffer)
        page_break_merges += count_page_break_merges(paragraphs)
        for paragraph in paragraphs:
            append_segmented_paragraph(paragraph, page_body_size, page_height)
        paragraph_buffer = []

    for page in document.pages:
        index = 0
        while index < len(page.lines):
            line = page.lines[index]
            text = clean_text(line.text)
            inline_fraction_node, consumed = detect_inline_fraction_list_block(page.lines, index)
            if inline_fraction_node is not None:
                flush_paragraphs(page.body_size, page.height)
                nodes.append(inline_fraction_node)
                fraction_candidates += 1
                index += consumed
                continue
            fraction_node, consumed = detect_fraction_formula_block(page.lines, index)
            if fraction_node is not None:
                flush_paragraphs(page.body_size, page.height)
                nodes.append(fraction_node)
                fraction_candidates += 1
                index += consumed
                continue
            definition_node, consumed = detect_definition_gloss_block(page.lines, index)
            if definition_node is not None:
                flush_paragraphs(page.body_size, page.height)
                nodes.append(definition_node)
                definition_gloss_blocks += 1
                index += consumed
                continue
            if references_started or (line.region == "body" and is_references_heading(text)):
                flush_paragraphs(page.body_size, page.height)
                references_started = True
                if text and line.region not in {"header", "footer", "footnote"}:
                    reference_lines.append(line)
                index += 1
                continue
            if line.region in {"header", "footer", "footnote"}:
                quarantined += 1
                index += 1
                continue
            if (page.page_num, line.line_id) in figure_line_keys:
                flush_paragraphs(page.body_size, page.height)
                if line.region == "figure":
                    nodes.append(DocumentNode(kind="figure", text=text, page_num=page.page_num, lines=[line], confidence=line.confidence))
                else:
                    quarantined += 1
                index += 1
                continue
            if line.region == "body":
                paragraph_buffer.append(line)
                index += 1
                continue
            flush_paragraphs(page.body_size, page.height)
            if line.region == "formula":
                nodes.append(DocumentNode(kind="display_formula", text=line.text, page_num=page.page_num, lines=[line], confidence=line.confidence))
            elif line.region == "figure":
                nodes.append(DocumentNode(kind="figure", text=text, page_num=page.page_num, lines=[line], confidence=line.confidence))
            else:
                nodes.append(DocumentNode(kind="paragraph", text=text, page_num=page.page_num, lines=[line]))
            index += 1
    if document.pages:
        last = document.pages[-1]
        flush_paragraphs(last.body_size, last.height)

    references = collect_reference_entries(reference_lines)
    profile = detect_note_profile(document.pages)
    note_refs = [marker for marker in inline_markers if marker.kind == "note_ref"]
    linked_markers = {note.marker for note in footnotes if note.linked}
    unresolved_note_refs = [marker for marker in note_refs if marker.marker not in linked_markers]
    stats = {
        "bibliographic_citations": len([marker for marker in inline_markers if marker.kind == "bibliographic_citation"]),
        "linked_notes": len([note for note in footnotes if note.linked]),
        "unlinked_notes": len([note for note in footnotes if not note.linked]),
        "unresolved_note_refs": len(unresolved_note_refs),
        "reference_entries": len(references),
        "quarantined_lines": quarantined,
        "figure_area_lines": len(figure_line_keys),
        "page_break_merges": page_break_merges,
        "definition_gloss_blocks": definition_gloss_blocks,
        "fraction_candidates": fraction_candidates,
        "low_confidence_fraction": 0,
        "ordered_list_recovered": ordered_list_recovered,
        "blockquote_blocks": blockquote_blocks,
        "has_numeric_bibliography": profile.has_numeric_bibliography,
        "has_page_footnotes": profile.has_page_footnotes,
        "low_confidence_math": len([node for node in nodes if node.kind == "display_formula" and node.confidence < 0.8]),
    }
    return DocumentPlan(nodes=nodes, footnotes=footnotes, references=references, inline_markers=inline_markers, stats=stats)


def is_marginal(line: TextLine) -> bool:
    return line.region in {"header", "footer"}


def is_heading(line: TextLine, body_size: float, page_height: float) -> bool:
    if not line.is_bold or body_size <= 0:
        return False
    if line.font_size >= body_size + 4:
        return True
    return line.font_size >= body_size + 2 and line.bbox.y0 < page_height * 0.35


def is_display_heading_block(paragraph: list[TextLine], body_size: float, page_height: float) -> bool:
    if body_size <= 0 or not 1 <= len(paragraph) <= 4:
        return False
    first = paragraph[0]
    if first.bbox.y0 > page_height * 0.45:
        return False
    text = clean_text(" ".join(line.text for line in paragraph))
    if not text or len(text) > 220:
        return False
    if any(re.search(r"[.;!?][”\"')\]]?$", clean_text(line.text)) for line in paragraph[:-1]):
        return False
    sizes = [line.font_size for line in paragraph if line.font_size > 0]
    if not sizes:
        return False
    return min(sizes) >= body_size + 2.0 or (first.font_size >= body_size + 4.0 and min(sizes) >= body_size + 1.0)


def is_structural_heading(line: TextLine, body_size: float, page_height: float) -> bool:
    return (
        is_numbered_heading(line)
        or is_roman_heading(line)
        or is_common_section_heading(line)
        or is_standalone_section_label(line, body_size, page_height)
    )


def infer_page_text_edges(document: ExtractedDocument) -> dict[int, tuple[float, float]]:
    page_edges: dict[int, tuple[float, float]] = {}
    all_lefts: list[float] = []
    all_rights: list[float] = []
    for page in document.pages:
        candidates = [
            line
            for line in page.lines
            if line.region == "body"
            and clean_text(line.text)
            and line.bbox.width >= page.width * 0.42
            and line.bbox.y0 > page.height * 0.08
            and line.bbox.y1 < page.height * 0.9
        ]
        if candidates:
            lefts = [line.bbox.x0 for line in candidates]
            rights = [line.bbox.x1 for line in candidates]
            left = percentile(lefts, 0.1)
            right = percentile(rights, 0.9)
            page_edges[page.page_num] = (left, right)
            all_lefts.append(left)
            all_rights.append(right)
    if all_lefts and all_rights:
        fallback = (percentile(all_lefts, 0.1), percentile(all_rights, 0.9))
        for page in document.pages:
            page_edges.setdefault(page.page_num, fallback)
    return page_edges


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return ordered[index]


def is_display_quote_block(paragraph: list[TextLine], text_edges: dict[int, tuple[float, float]]) -> bool:
    if not paragraph:
        return False
    if len(paragraph) == 1 and not looks_like_standalone_display_quote(paragraph[0]):
        return False
    checked = 0
    for line in paragraph:
        text = clean_text(line.text)
        if not text:
            continue
        edges = text_edges.get(line.page_num)
        if edges is None:
            return False
        left, right = edges
        inset = max(7.0, line.font_size * 0.65)
        if line.bbox.x0 < left + inset:
            return False
        if line.bbox.x1 > right - inset:
            return False
        checked += 1
    return checked > 0


def looks_like_standalone_display_quote(line: TextLine) -> bool:
    text = clean_text(line.text)
    return bool(re.match(r"^\[\d{1,3}\]\s+\S", text))


def is_standalone_section_label(line: TextLine, body_size: float, page_height: float) -> bool:
    text = clean_text(line.text)
    if body_size <= 0 or not text:
        return False
    if line.font_size > body_size * 0.95:
        return False
    if line.bbox.y0 > page_height * 0.7:
        return False
    if len(text) > 32 or len(text.split()) > 3:
        return False
    letters = re.sub(r"[^A-Za-z]", "", text)
    return bool(letters) and letters.upper() == letters


def is_common_section_heading(line: TextLine) -> bool:
    text = clean_text(line.text).lower().strip(" .:")
    return text in COMMON_SECTION_HEADINGS


def heading_level(line: TextLine, body_size: float) -> int:
    if line.font_size >= body_size + 5:
        return 1
    if line.font_size >= body_size + 3:
        return 2
    return 3


def is_numbered_heading(line: TextLine) -> bool:
    text = clean_text(line.text)
    if not re.match(r"^\d+(?:\.\d+)*\.\s+\S", text):
        return False
    return len(text) <= 120


def is_roman_heading(line: TextLine) -> bool:
    text = clean_text(line.text)
    return len(text) <= 160 and bool(ROMAN_SECTION_RE.match(text))


def structural_heading_level(line: TextLine, body_size: float, page_height: float) -> int:
    if is_roman_heading(line) or is_common_section_heading(line):
        return 2
    if is_standalone_section_label(line, body_size, page_height):
        return 3
    return numbered_heading_level(line)


def numbered_heading_level(line: TextLine) -> int:
    marker = clean_text(line.text).split(maxsplit=1)[0]
    depth = marker.count(".")
    return max(2, min(6, depth + 1))


def is_list_start(line: TextLine) -> bool:
    return detect_list_marker(line) is not None


def detect_list_marker(line: TextLine) -> dict[str, int | str | bool] | None:
    if is_numbered_heading(line):
        return None
    text = clean_text(line.text)
    if re.match(r"^(?:[•·∙]|[-*]\s+)", text):
        return {"kind": "unordered", "level": 0, "index": 0, "marker": "", "recovered": False}
    prime_numeric = re.match(r"^\((\d{1,3})[′']\)\s+", text)
    if prime_numeric:
        return {
            "kind": "ordered",
            "level": 0,
            "index": int(prime_numeric.group(1)),
            "marker": f"{prime_numeric.group(1)}′",
            "recovered": False,
        }
    numeric = re.match(r"^(\d{1,3})[.)]\s+", text)
    if numeric:
        return {"kind": "ordered", "level": 0, "index": int(numeric.group(1)), "marker": "", "recovered": False}
    alpha = re.match(r"^(?P<marker>\(?([a-z])\))[\s.]+", text)
    if alpha:
        letter = alpha.group(2)
        return {
            "kind": "ordered",
            "level": 1,
            "index": ord(letter) - ord("a") + 1,
            "marker": alpha.group("marker"),
            "recovered": False,
        }
    corrupt = re.match(r"^([xyz{])\s+(?:∴|[A-Z]\b|\$?[A-Z])", text)
    if corrupt and line.bbox.x0 > 70:
        index_by_marker = {"x": 1, "y": 2, "z": 3, "{": 4}
        return {"kind": "ordered", "level": 0, "index": index_by_marker[corrupt.group(1)], "marker": "", "recovered": True}
    return None


def is_list_continuation(first: TextLine, previous: TextLine, candidate: TextLine) -> bool:
    if first.column != candidate.column:
        return False
    if is_numbered_heading(candidate):
        return False
    y_gap = candidate.bbox.y0 - previous.bbox.y1
    line_height = max(previous.font_size, candidate.font_size, previous.bbox.height, candidate.bbox.height, 1.0)
    if y_gap > line_height * 1.7:
        return False
    return candidate.bbox.x0 >= first.bbox.x0 - max(3.0, candidate.font_size * 0.35)


def detect_figure_area_lines(document: ExtractedDocument) -> set[tuple[int, int]]:
    keys: set[tuple[int, int]] = set()
    for page in document.pages:
        captions = [line for line in page.lines if line.region == "figure"]
        for caption in captions:
            keys.add((page.page_num, caption.line_id))
            top = max(0.0, caption.bbox.y0 - 180)
            for line in page.lines:
                if line.line_id == caption.line_id:
                    continue
                if line.bbox.y0 < top or line.bbox.y1 > caption.bbox.y0 + max(12, caption.font_size * 1.5):
                    continue
                if line.region == "formula" or is_short_figure_label(clean_text(line.text)):
                    keys.add((page.page_num, line.line_id))
    return keys


def detect_definition_gloss_block(lines: list[TextLine], index: int) -> tuple[DocumentNode | None, int]:
    if index + 1 >= len(lines):
        return None, 0
    formula_line = lines[index]
    gloss_line = lines[index + 1]
    if formula_line.region not in {"body", "formula"} or gloss_line.region != "body":
        return None, 0
    formula_text = clean_text(formula_line.text)
    gloss_text = clean_text(gloss_line.text)
    if not re.match(r"^\([A-Z][A-Za-z0-9]*\)\s+\S", formula_text):
        return None, 0
    if not (gloss_text.startswith("[") and gloss_text.endswith("]")):
        return None, 0
    line_height = max(formula_line.font_size, gloss_line.font_size, formula_line.bbox.height, gloss_line.bbox.height, 1.0)
    same_row = abs(formula_line.bbox.y0 - gloss_line.bbox.y0) <= line_height * 0.75
    aligned_right = gloss_line.bbox.x0 >= formula_line.bbox.x1 + max(20.0, line_height * 2.0)
    if not (same_row and aligned_right):
        return None, 0
    return (
        DocumentNode(
            kind="definition_item",
            text=f"{formula_text} {gloss_text}",
            page_num=formula_line.page_num,
            lines=[formula_line, gloss_line],
            confidence=min(formula_line.confidence, gloss_line.confidence, 0.88),
        ),
        2,
    )


def detect_fraction_formula_block(lines: list[TextLine], index: int) -> tuple[DocumentNode | None, int]:
    window = lines[index : index + 5]
    if len(window) < 2:
        return None, 0
    trailing_unit_fraction, consumed = detect_trailing_unit_fraction_block(window)
    if trailing_unit_fraction is not None:
        return trailing_unit_fraction, consumed
    if len(window) < 4:
        return None, 0
    if not re.fullmatch(r"\d{1,6}", clean_text(window[0].text)):
        return None, 0
    formula_indices = [offset for offset, line in enumerate(window) if line.region == "formula"]
    if not formula_indices:
        return None, 0
    formula_offset = formula_indices[0]
    formula_line = window[formula_offset]
    if not re.search(r"\bPr\s*\(", clean_text(formula_line.text)):
        return None, 0
    numerators = [line for line in window[:formula_offset] if re.fullmatch(r"\d{1,6}", clean_text(line.text))]
    denominator_lines = [line for line in window[formula_offset + 1 :] if re.match(r"^\d{2,8}\b", clean_text(line.text))]
    if not numerators or not denominator_lines:
        return None, 0
    first_denominator = clean_text(denominator_lines[0].text)
    if "<" not in first_denominator and "=" not in first_denominator and len(denominator_lines) < 2:
        return None, 0
    left_num = clean_text(numerators[0].text)
    left_den_match = re.match(r"(?P<den>\d{2,8})\s*(?P<rel>[<>=])?\s*(?P<rhs>.*)", first_denominator)
    if not left_den_match:
        return None, 0
    relation = left_den_match.group("rel") or "<"
    pieces = [unicode_math_to_latex(clean_text(formula_line.text)), rf"\frac{{{left_num}}}{{{left_den_match.group('den')}}}", relation]
    first_rhs = clean_text(left_den_match.group("rhs") or "")
    if relation == "=" and first_rhs:
        pieces.append(unicode_math_to_latex(first_rhs))
    if len(numerators) >= 2 and len(denominator_lines) >= 2:
        right_num = clean_text(numerators[1].text)
        second_denominator = clean_text(denominator_lines[1].text)
        right_den_match = re.match(r"(?P<den>\d{2,8})\s*=\s*(?P<rhs>.+)", second_denominator)
        if right_den_match:
            pieces.append(rf"\frac{{{right_num}}}{{{right_den_match.group('den')}}}")
            pieces.append("=")
            pieces.append(unicode_math_to_latex(right_den_match.group("rhs")))
    consumed = max(
        formula_offset + 1,
        max((window.index(line) + 1 for line in denominator_lines), default=formula_offset + 1),
    )
    node = DocumentNode(
        kind="latex_display_formula",
        text=clean_text(" ".join(pieces)),
        page_num=formula_line.page_num,
        lines=window[:consumed],
        confidence=0.82,
    )
    return node, consumed


def detect_trailing_unit_fraction_block(window: list[TextLine]) -> tuple[DocumentNode | None, int]:
    if len(window) < 2 or window[0].region != "formula":
        return None, 0
    first_text = clean_text(window[0].text)
    second_text = clean_text(window[1].text)
    first_match = re.match(r"^(?P<prefix>.+[<>=])\s*1\.?$", first_text)
    second_match = re.match(r"^(?P<den>\d{1,5})\s*=\s*(?P<rhs>Pr\(.+?\))\.?$", second_text)
    if not first_match or not second_match:
        return None, 0
    latex = " ".join(
        [
            unicode_math_to_latex(first_match.group("prefix")),
            rf"\frac{{1}}{{{second_match.group('den')}}}",
            "=",
            unicode_math_to_latex(second_match.group("rhs")),
        ]
    )
    return (
        DocumentNode(
            kind="latex_display_formula",
            text=clean_text(latex),
            page_num=window[0].page_num,
            lines=window[:2],
            confidence=0.82,
        ),
        2,
    )


def detect_inline_fraction_list_block(lines: list[TextLine], index: int) -> tuple[DocumentNode | None, int]:
    window = lines[index : index + 5]
    if len(window) < 5:
        short_window = lines[index : index + 3]
        if len(short_window) == 3:
            return build_inline_fraction_list_node(
                list_line=short_window[0],
                left_den_line=short_window[1],
                right_den_line=short_window[2],
                left_num="1",
                right_num="1",
                consumed=3,
            )
        return None, 0
    list_first = build_inline_fraction_list_node(
        list_line=window[0],
        left_den_line=window[1],
        right_den_line=window[2],
        left_num="1",
        right_num="1",
        consumed=3,
    )
    if list_first[0] is not None:
        return list_first
    if not (re.fullmatch(r"\d{1,4}", clean_text(window[0].text)) and re.fullmatch(r"\d{1,4}", clean_text(window[1].text))):
        return None, 0
    if detect_list_marker(window[2]) is not None:
        left_num, right_num = sorted([window[0], window[1]], key=lambda line: line.bbox.x0)
        primary = build_inline_fraction_list_node(
            list_line=window[2],
            left_den_line=window[3],
            right_den_line=window[4],
            left_num=clean_text(left_num.text),
            right_num=clean_text(right_num.text),
            consumed=5,
        )
        if primary[0] is not None:
            return primary
        return build_inline_fraction_list_node(
            list_line=window[2],
            left_den_line=window[4],
            right_den_line=window[3],
            left_num=clean_text(left_num.text),
            right_num=clean_text(right_num.text),
            consumed=5,
        )
    if detect_list_marker(window[4]) is not None:
        left_num, right_num = sorted([window[0], window[1]], key=lambda line: line.bbox.x0)
        return build_inline_fraction_list_node(
            list_line=window[4],
            left_den_line=window[2],
            right_den_line=window[3],
            left_num=clean_text(left_num.text),
            right_num=clean_text(right_num.text),
            consumed=5,
        )
    return None, 0


def build_inline_fraction_list_node(
    list_line: TextLine,
    left_den_line: TextLine,
    right_den_line: TextLine,
    left_num: str,
    right_num: str,
    consumed: int,
) -> tuple[DocumentNode | None, int]:
    if detect_list_marker(list_line) is None:
        return None, 0
    list_text = clean_text(list_line.text)
    left_den_text = clean_text(left_den_line.text)
    right_den_text = clean_text(right_den_line.text)
    if "Pr(" not in list_text or not re.match(r"^\d{1,5}\s*[<>=]", left_den_text):
        return None, 0
    right_match = re.match(r"^(?P<den>\d{1,5})\s*=\s*(?P<rhs>Pr\(.+?\))\.?$", right_den_text)
    if not right_match:
        return None, 0
    left_match = re.match(r"^(?P<den>\d{1,5})\s*(?P<rel>[<>=])", left_den_text)
    formula_match = re.match(r"^(?P<prose>.*?)(?P<formula>Pr\(.+?\)\s*=)\s*$", strip_raw_list_marker(list_text))
    if not left_match or not formula_match:
        return None, 0
    latex = " ".join(
        [
            unicode_math_to_latex(formula_match.group("formula")),
            rf"\frac{{{left_num}}}{{{left_match.group('den')}}}",
            left_match.group("rel"),
            rf"\frac{{{right_num}}}{{{right_match.group('den')}}}",
            "=",
            unicode_math_to_latex(right_match.group("rhs")),
        ]
    )
    text = f"{clean_text(formula_match.group('prose'))} ${latex}$"
    marker = detect_list_marker(list_line) or {"kind": "unordered", "level": 0, "index": 0, "marker": ""}
    return (
        DocumentNode(
            kind="list_item",
            text=text,
            page_num=list_line.page_num,
            list_kind=str(marker["kind"]),
            list_level=int(marker["level"]),
            list_index=int(marker["index"]),
            list_marker=str(marker.get("marker", "")),
            confidence=0.82,
        ),
        consumed,
    )


def strip_raw_list_marker(text: str) -> str:
    return re.sub(r"^(?:[•·∙]|[-*]|\(\d{1,3}[′']\)|\d{1,3}[′'][.]?|\d{1,3}[.)]|[xyz{])\s*", "", clean_text(text)).strip()


def is_short_figure_label(text: str) -> bool:
    if not text or len(text) > 90:
        return False
    if math_density(text) > 0.08:
        return True
    if re.fullmatch(r"\(?[A-Z]{1,6}[0-9]?\)?", text):
        return True
    if re.search(r"[&=↑⇑⇕→↔⊃≡∀∃]", text):
        return True
    if re.fullmatch(r"\([A-Z]{1,8}\)", text):
        return True
    return False
