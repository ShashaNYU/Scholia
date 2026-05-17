from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scholar_md.layout import assign_columns, prepare_layout, sort_lines_for_reading
from scholar_md.models import BBox, ExtractedDocument, PageLayout, TextLine, TextSpan


def line(text: str, x0: float, y0: float, x1: float, y1: float) -> TextLine:
    return TextLine(
        spans=[],
        page_num=1,
        line_id=int(y0),
        bbox=BBox(x0, y0, x1, y1),
        text=text,
        font_size=10,
    )


def span_line(text: str, x0: float, y0: float, x1: float, y1: float, line_id: int) -> TextLine:
    return TextLine.from_spans(
        [TextSpan(text=text, bbox=BBox(x0, y0, x1, y1), size=10, page_num=1)],
        page_num=1,
        line_id=line_id,
    )


class LayoutTest(unittest.TestCase):
    def test_two_column_reading_order_keeps_left_column_before_right(self) -> None:
        page = PageLayout(
            page_num=1,
            width=600,
            height=800,
            lines=[
                line("Title", 90, 40, 510, 60),
                line("L1", 60, 120, 250, 132),
                line("R1", 340, 120, 530, 132),
                line("L2", 60, 150, 250, 162),
                line("R2", 340, 150, 530, 162),
            ],
        )
        assign_columns(page)
        ordered = sort_lines_for_reading(page.lines, page.columns)
        self.assertEqual(page.columns, 2)
        self.assertEqual([item.text for item in ordered], ["Title", "L1", "L2", "R1", "R2"])

    def test_same_baseline_word_fragments_are_recombined_before_column_detection(self) -> None:
        words = [
            ("disputes", 58, 136, 90),
            ("that", 99, 136, 113),
            ("are", 122, 136, 134),
            ("intuitively", 142, 136, 182),
            ("ones", 191, 136, 209),
            ("about", 217, 136, 243),
            ("free", 251, 136, 266),
            ("will", 274, 136, 295),
        ]
        lines = [span_line("Before paragraph.", 58, 100, 180, 112, 0)]
        lines.extend(span_line(text, x0, y0, x1, y0 + 10, index + 1) for index, (text, x0, y0, x1) in enumerate(words))
        lines.append(span_line("After paragraph.", 58, 160, 180, 172, 20))
        page = PageLayout(page_num=1, width=425, height=652, lines=lines)
        document = ExtractedDocument(pdf_path="x.pdf", metadata={}, pages=[page])

        prepare_layout(document)

        self.assertEqual(page.columns, 1)
        self.assertIn("disputes that are intuitively ones about free will", [item.text for item in page.lines])


if __name__ == "__main__":
    unittest.main()
